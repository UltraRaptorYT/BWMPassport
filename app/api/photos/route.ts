import { createClient } from "@supabase/supabase-js";
import { makePhotoFilename } from "../../lib/photo-filename";

export const runtime = "nodejs";

const BUCKET = "zest-student-photos";
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const VALID_LEVELS = new Set(["K1", "K2", "P1", "P2", "P3", "P4", "P5", "P6"]);
const VALID_CLASS_DISTRICTS = new Map([
  ["a", "A"],
  ["b", "B"],
  ["tampines", "Tampines"],
  ["jurong", "Jurong"],
  ["aljunied", "Aljunied"],
]);

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const secretKey =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !secretKey) {
      return Response.json(
        { error: "Photo storage is not configured yet. Please ask the site administrator." },
        { status: 503 },
      );
    }

    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return Response.json({ error: "This upload request is not allowed." }, { status: 403 });
    }

    const form = await request.formData();
    const photo = form.get("photo");
    const name = cleanText(form.get("name"));
    const classGroup = VALID_CLASS_DISTRICTS.get(
      cleanText(form.get("classGroup")).toLowerCase(),
    );
    const level = cleanText(form.get("level")).toUpperCase();

    if (!(photo instanceof File) || photo.type !== "image/jpeg") {
      return Response.json({ error: "Please upload a cropped JPEG photo." }, { status: 400 });
    }
    if (photo.size === 0 || photo.size > MAX_FILE_SIZE) {
      return Response.json({ error: "The photo must be smaller than 12 MB." }, { status: 400 });
    }
    if (name.length < 1 || name.length > 80) {
      return Response.json({ error: "Enter a valid student name." }, { status: 400 });
    }
    if (!classGroup || !VALID_LEVELS.has(level)) {
      return Response.json(
        { error: "Choose a valid class / district and level." },
        { status: 400 },
      );
    }

    const filename = makePhotoFilename(name, level, classGroup);
    const path = `${level}/class-${classGroup}/${filename}`;

    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bytes = await photo.arrayBuffer();
    const { data, error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: true,
      metadata: {
        student_name: name,
        class_group: classGroup,
        level,
        physical_ratio: "34x44mm",
        output_size: "2000x2570",
        background: "white",
      },
    });

    if (error) {
      console.error("Supabase photo upload failed", error.message);
      return Response.json(
        { error: "The photo could not be saved. Please try again." },
        { status: 502 },
      );
    }

    return Response.json({ path: data.path }, { status: 201 });
  } catch (error) {
    console.error("Photo upload request failed", error);
    return Response.json(
      { error: "The upload could not be completed. Please try again." },
      { status: 500 },
    );
  }
}

function cleanText(value: FormDataEntryValue | null) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F\u007F]/g, "").trim()
    : "";
}
