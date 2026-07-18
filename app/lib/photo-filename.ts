export function makePhotoFilename(
  name: string,
  level: string,
  classGroup: string,
) {
  const safeName = name
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[<>:\"|?*\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Student";

  return `${safeName}-${level.toLowerCase()}-class ${classGroup}.jpg`;
}
