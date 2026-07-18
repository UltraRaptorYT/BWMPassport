# BWM Photo Passport

A mobile-friendly camera app for collecting consistent student photos. It can:

- take a photo with the device camera or choose one from the gallery;
- automatically capture camera photos in the required 2000:2570 frame;
- crop only images selected from the device;
- export a high-quality 2000 × 2570 JPEG;
- remove the background in the browser with `@imgly/background-removal` and replace it with passport white;
- show a head-and-shoulders positioning guide during capture and cropping;
- collect the student's name, class (A/B), and level (K1–K2, P1–P6);
- upload securely into a private Supabase Storage bucket.

## Supabase setup

1. Create or choose a Supabase project.
2. Link this folder and apply the included bucket migration:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

3. Copy `.env.example` to `.env.local` and add your project URL and secret key from **Project Settings → API Keys**. Legacy projects can use the service role key instead.

   The secret/service role key is server-only. Never rename it with a `NEXT_PUBLIC_` prefix or commit `.env.local`.

The migrations create a private `zest-student-photos` bucket that accepts JPEG files up to 12 MB. The browser has no direct bucket access; uploads go through the validated server endpoint.

Files are named from the submitted student details:

```text
zest-student-photos/
  P5/
    class-A/
      Person Name-p5-class A.jpg
```

Uploading the same student, level, and class again replaces the existing file.

Student name, class, level, and output dimensions are also stored as object metadata.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Camera access requires `localhost` or an HTTPS deployment.

Background removal uses IMG.LY's AGPL-licensed browser package. Its model is downloaded and cached by the browser on first use.
The app begins preloading that model when the camera screen opens, so processing can start sooner after capture.

## Checks

```bash
npm run lint
npm run build
```
