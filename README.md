# BWM Photo Passport

A mobile-friendly camera app for collecting consistent student photos. It can:

- take a photo with the device camera or choose one from the gallery;
- automatically capture camera photos in the required 2000:2570 frame;
- crop only images selected from the device;
- export a high-quality 2000 × 2570 JPEG;
- remove the background in the browser with `@imgly/background-removal` and replace it with passport white;
- show a head-and-shoulders positioning guide during capture and cropping;
- collect the person's name, class/district, level, and Cadres/Teachers status;
- upload securely into a private Google Drive folder.

## Google Drive setup

1. Create or choose a Google Cloud project and enable the **Google Drive API**.
2. Create a private destination folder in Google Drive. Copy the folder ID from its URL:

   ```text
   https://drive.google.com/drive/folders/FOLDER_ID
   ```

3. Configure one server-side authentication method:

   - **Personal Drive or a Workspace user:** create OAuth 2.0 credentials, authorize the `https://www.googleapis.com/auth/drive` scope, and obtain a refresh token.
   - **Workspace Shared Drive:** create a service account and give it write access to the destination. Service accounts cannot own files, so use a Shared Drive or enable domain-wide delegation and set a user to impersonate.

   For service-account authentication, set `GOOGLE_SERVICE_EMAIL` to the JSON key's `client_email` value and `GOOGLE_PRIVATE_KEY` to its `private_key` value. Keep the private key server-only. The older `GOOGLE_SERVICE_ACCOUNT_EMAIL` name is also accepted.

4. Copy `.env.example` to `.env.local`, set `GOOGLE_DRIVE_FOLDER_ID`, and fill in either the OAuth or service-account variables.

All Google credentials are server-only. Never add a `NEXT_PUBLIC_` prefix or commit `.env.local`.

The browser has no direct Drive access. JPEG uploads of up to 12 MB go through the validated server endpoint and are routed into the existing Yearbook folder structure. Missing folders are reported as errors instead of being created automatically.

Uploads use these destinations:

| Selection | Existing Drive destination |
| --- | --- |
| Class A/B | `BW (Woodlands) 吉寺/BW [level band]/Class A` or `Class B` |
| Tampines | `Tampines 谈宾尼分院/Students` |
| Jurong | `Tradehub (Jurong) 裕廊分院/Students` |
| Aljunied AM | `Aljunied 阿裕尼分院/Aljunied AM [level band]/Students` |
| Aljunied PM | `Aljunied 阿裕尼分院/Aljunied PM K1-P6/Students` |

When **Cadres / Teachers** is enabled, the final student/class folder is replaced by the existing `Cadres/Teachers` folder.

Uploading the same person, level, and class/district again replaces the existing file.

Name, class, level, Cadres/Teachers status, destination path, and output dimensions are also stored in the Drive file description. Searchable non-name fields are stored as private application properties. Cadres/Teachers status defaults to off.

For faster uploads, the server reuses its authenticated Drive client and caches resolved folder/file IDs on warm instances. The final 2000 × 2570 JPEG retains the original high-quality `0.97` setting.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Camera access requires `localhost` or an HTTPS deployment.

Background removal uses IMG.LY's AGPL-licensed browser package. Its model is downloaded and cached by the browser on first use.
The app begins preloading that model when the camera screen opens, so processing can start sooner after capture.
On mobile, it uses IMG.LY's lower-memory quantized model with a single WASM thread, then applies the resulting mask to the original 2000 × 2570 image.

## Checks

```bash
npm run lint
npm run build
```
