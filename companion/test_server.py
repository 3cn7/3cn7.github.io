import unittest
from unittest.mock import patch
from pathlib import Path
import tempfile
import json
import threading
import urllib.request
import urllib.error
import server

class PipelineTests(unittest.TestCase):
    def test_chunk_ranges_preserve_every_second_and_prefer_silence(self):
        ranges = server.chunk_ranges(1800, [535, 1070])
        self.assertEqual(ranges[0], (0, 535))
        self.assertEqual(ranges[-1][-1], 1800)
        self.assertEqual(sum(end-start for start,end in ranges), 1800)
        for first, second in zip(ranges, ranges[1:]):
            self.assertEqual(first[1], second[0])
            self.assertLessEqual(first[1]-first[0], 540)
    def test_cloud_model_capabilities_and_original_languages(self):
        job={'cancel':threading.Event()}
        text='Oggi parleremo della Sicilia. Does anyone remember where Sicily is located?'
        fake={'text':text,'languages':[{'code':'it'},{'code':'en'}]}
        with patch.object(server,'cloud_request',return_value=fake) as request:
            result=server.transcribe_cloud(Path('audio.wav'),0,{'language':'mixed','timestamps':'false'},job)
            self.assertEqual(result['text'],text)
            self.assertEqual(result['segments'],[])
            self.assertEqual(request.call_args.args[1]['model'],'gpt-transcribe')
            self.assertNotIn('language',request.call_args.args[1])
            self.assertEqual(request.call_args.args[1]['languages[]'],['en','it'])
        with patch.object(server,'cloud_request',return_value={'text':'è così','segments':[{'start':1,'end':2,'text':'è così'}]}) as request:
            result=server.transcribe_cloud(Path('audio.wav'),540,{'language':'it','timestamps':'true'},job)
            self.assertEqual(result['segments'][0]['start'],541)
            self.assertEqual(request.call_args.args[1]['model'],'whisper-1')
        with patch.object(server,'cloud_request',return_value={'text':'Hello','segments':[{'start':0,'end':2,'text':'Hello','speaker':'A'}]}) as request:
            result=server.transcribe_cloud(Path('audio.wav'),0,{'speakers':'true'},job)
            self.assertEqual(request.call_args.args[1]['response_format'],'diarized_json')
            self.assertEqual(result['segments'][0]['speaker'],'A')
    def test_missing_local_model_and_cancel_never_switch_to_cloud(self):
        with patch.object(server,'available_models',return_value=[]), patch.object(server,'transcribe_cloud') as cloud:
            with self.assertRaisesRegex(ValueError,'LOCAL MODEL'):
                server.transcribe_local(Path('a'),0,{'quality':'balanced'},{'cancel':threading.Event()})
            cloud.assert_not_called()
        event=threading.Event();event.set()
        with self.assertRaises(InterruptedError):
            server.cancelled({'cancel':event})
    def test_mock_pipeline_joins_chunks_in_order_and_keeps_timestamps(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'source';path.write_bytes(b'audio')
            job={'id':'test','path':str(path),'options':{'engine':'local'},'cancel':threading.Event(),'parts':[]}
            def local(wav,offset,options,job):
                return {'text':'ciao' if offset==0 else 'hello','segments':[{'start':offset,'end':offset+1,'text':'ciao' if offset==0 else 'hello'}],'languages':[{'code':'it' if offset==0 else 'en'}]}
            def decode(command,job):
                if command[-1].endswith('.wav'): Path(command[-1]).write_bytes(b'wav')
                return b'',b''
            with patch.object(server,'checkpoint'),patch.object(server,'probe_audio',return_value=600),patch.object(server,'silence_boundaries',return_value=[]),patch.object(server,'process',side_effect=decode),patch.object(server,'transcribe_local',side_effect=local),patch.object(server,'transcribe_cloud') as cloud:
                server.run_transcription(job)
                self.assertEqual(job['status'],'done')
                self.assertEqual(job['result']['rawText'],'ciao\nhello')
                self.assertEqual(job['result']['segments'][1]['start'],540)
                cloud.assert_not_called()
                self.assertFalse(path.exists())
    def test_provider_result_validation_does_not_invent_a_transcript(self):
        with patch.object(server,'cloud_request',return_value={'error':'missing'}):
            with self.assertRaisesRegex(ValueError,'no transcript'):
                server.transcribe_cloud(Path('a'),0,{}, {'cancel':threading.Event()})
    def test_generation_enforces_structured_output(self):
        with patch.object(server,'openai_json',return_value={'output':[{'type':'message','content':[{'type':'output_text','text':'{"notes":"Class summary","cards":[]}'}]}]}) as api:
            result=server.generate_material({'kind':'notes','text':'class source'})
            self.assertEqual(result['notes'],'Class summary')
            body=json.loads(api.call_args.args[1]);self.assertTrue(body['text']['format']['strict'])
        with self.assertRaises(ValueError):server.generate_material({'text':''})
    def test_cloud_multipart_sends_repeated_language_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'audio.wav';path.write_bytes(b'fixture')
            with patch.dict(server.os.environ,{'OPENAI_API_KEY':'unit-test-only'}),patch.object(server,'openai_json',return_value={'text':'ciao'}) as api:
                server.cloud_request(path,{'model':'gpt-transcribe','languages[]':['en','it']},{'cancel':threading.Event()})
                body=api.call_args.args[1]
                self.assertEqual(body.count(b'name="languages[]"'),2)
                self.assertIn(b'\r\n\r\nen\r\n',body)
                self.assertIn(b'\r\n\r\nit\r\n',body)

class AuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.http.server_address[1]
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close()
    def test_authentication_and_origin_restrictions(self):
        url=f'http://127.0.0.1:{self.port}/health'
        with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(url)
        self.assertEqual(err.exception.code,401)
        req=urllib.request.Request(url,headers={'Authorization':'Bearer '+server.TOKEN,'Origin':'https://evil.example'})
        with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(req)
        self.assertEqual(err.exception.code,403)
        req=urllib.request.Request(url,headers={'Authorization':'Bearer '+server.TOKEN,'Origin':'https://3cn7.github.io'})
        with urllib.request.urlopen(req) as response:
            self.assertEqual(response.status,200)
            data=json.load(response);self.assertIn('localModels',data);self.assertNotIn('token',data)

if __name__=='__main__':unittest.main()
