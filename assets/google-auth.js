export class GoogleAuth {
  constructor() {
    this.accessToken = "";
    this.expiresAt = 0;
    this.loading = null;
  }
  token() {
    return Date.now() < this.expiresAt ? this.accessToken : "";
  }
  get clientId() {
    return localStorage.getItem("studyPlatform.oauthClientId") || "";
  }
  configure(clientId) {
    clientId = String(clientId).trim();
    if (clientId && !clientId.endsWith(".apps.googleusercontent.com"))
      throw new Error("Enter a Google web OAuth client ID.");
    localStorage.setItem("studyPlatform.oauthClientId", clientId);
    this.accessToken = "";
    this.expiresAt = 0;
  }
  async load() {
    if (globalThis.google?.accounts?.oauth2) return;
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const timeout = setTimeout(() => {
        script.remove();
        reject(
          new Error("Google sign-in did not load. Check your connection."),
        );
      }, 15000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error("Google sign-in could not load."));
      };
      document.head.append(script);
    }).finally(() => (this.loading = null));
    return this.loading;
  }
  async connect() {
    if (!this.clientId)
      throw new Error(
        "Add your OAuth client ID in Google Drive settings first.",
      );
    if (!navigator.onLine)
      throw new Error("Connect to the internet to sign in.");
    await this.load();
    const response = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: "https://www.googleapis.com/auth/drive.file",
        include_granted_scopes: true,
        callback: (r) =>
          r.error
            ? reject(new Error(r.error_description || r.error))
            : resolve(r),
        error_callback: (e) =>
          reject(
            new Error(e.message || e.type || "Google sign-in was closed."),
          ),
      });
      client.requestAccessToken({ prompt: "select_account" });
    });
    this.accessToken = response.access_token;
    this.expiresAt =
      Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
  }
  disconnect() {
    this.accessToken = "";
    this.expiresAt = 0;
  }
}
