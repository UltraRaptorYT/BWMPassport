import { Readable } from "node:stream";
import { drive_v3, google } from "googleapis";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const CADRES_FOLDER = "Cadres/Teachers";
const folderIdCache = new Map<string, string>();
const fileIdCache = new Map<string, string>();
let cachedDriveClient: drive_v3.Drive | null = null;

const WOODLANDS_LEVEL_FOLDERS: Record<string, string> = {
  K1: "BW K1K2",
  K2: "BW K1K2",
  P1: "BW P1P2",
  P2: "BW P1P2",
  P3: "BW P3P4",
  P4: "BW P3P4",
  P5: "BW P5P6",
  P6: "BW P5P6",
};

const ALJUNIED_AM_LEVEL_FOLDERS: Record<string, string> = {
  K1: "Aljunied AM K1-K2",
  K2: "Aljunied AM K1-K2",
  P1: "Aljunied AM P1-P2",
  P2: "Aljunied AM P1-P2",
  P3: "Aljunied AM P3-P6",
  P4: "Aljunied AM P3-P6",
  P5: "Aljunied AM P3-P6",
  P6: "Aljunied AM P3-P6",
};

type PhotoUpload = {
  bytes: ArrayBuffer;
  filename: string;
  name: string;
  classGroup: string;
  level: string;
  isTeacher: boolean;
};

export function isGoogleDriveConfigured() {
  const hasOAuthCredentials = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );
  const hasServiceAccountCredentials = Boolean(
    getServiceAccountEmail() && process.env.GOOGLE_PRIVATE_KEY,
  );

  return Boolean(
    process.env.GOOGLE_DRIVE_FOLDER_ID &&
      (hasOAuthCredentials || hasServiceAccountCredentials),
  );
}

export async function uploadPhotoToGoogleDrive({
  bytes,
  filename,
  name,
  classGroup,
  level,
  isTeacher,
}: PhotoUpload) {
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootFolderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured.");
  }

  const drive = getDriveClient();
  const destinationPath = getDestinationPath(classGroup, level, isTeacher);
  const destinationFolderId = await findExistingFolderPath(
    drive,
    rootFolderId,
    destinationPath,
  );

  const existingFileId = await findFile(
    drive,
    destinationFolderId,
    filename,
  );
  const metadata = {
    student_name: name,
    class_group: classGroup,
    level,
    is_teacher: isTeacher,
    destination_path: destinationPath,
    physical_ratio: "34x44mm",
    output_size: "2000x2570",
    background: "white",
  };
  const requestBody: drive_v3.Schema$File = {
    name: filename,
    mimeType: "image/jpeg",
    description: JSON.stringify(metadata),
    appProperties: {
      class_group: classGroup,
      level,
      is_teacher: String(isTeacher),
      physical_ratio: metadata.physical_ratio,
      output_size: metadata.output_size,
      background: metadata.background,
    },
  };
  const media = {
    mimeType: "image/jpeg",
    body: Readable.from(Buffer.from(bytes)),
  };

  const response = existingFileId
    ? await drive.files.update({
        fileId: existingFileId,
        requestBody,
        media,
        supportsAllDrives: true,
        fields: "id",
      })
    : await drive.files.create({
        requestBody: { ...requestBody, parents: [destinationFolderId] },
        media,
        supportsAllDrives: true,
        fields: "id",
      });

  if (!response.data.id) {
    throw new Error("Google Drive did not return a file ID.");
  }
  fileIdCache.set(makeCacheKey(destinationFolderId, filename), response.data.id);

  return {
    id: response.data.id,
    path: `${destinationPath.join("/")}/${filename}`,
  };
}

function getDestinationPath(
  classGroup: string,
  level: string,
  isTeacher: boolean,
) {
  const peopleFolder = isTeacher ? CADRES_FOLDER : "Students";

  if (classGroup === "A" || classGroup === "B") {
    return [
      "BW (Woodlands) 吉寺",
      getLevelFolder(WOODLANDS_LEVEL_FOLDERS, level),
      isTeacher ? CADRES_FOLDER : `Class ${classGroup}`,
    ];
  }

  if (classGroup === "Tampines") {
    return ["Tampines 谈宾尼分院", peopleFolder];
  }

  if (classGroup === "Jurong") {
    return ["Tradehub (Jurong) 裕廊分院", peopleFolder];
  }

  if (classGroup === "Aljunied AM (10AM-12PM)") {
    return [
      "Aljunied 阿裕尼分院",
      getLevelFolder(ALJUNIED_AM_LEVEL_FOLDERS, level),
      peopleFolder,
    ];
  }

  if (classGroup === "Aljunied PM (3PM-5PM)") {
    return ["Aljunied 阿裕尼分院", "Aljunied PM K1-P6", peopleFolder];
  }

  throw new Error(`No Google Drive destination is configured for ${classGroup}.`);
}

function getLevelFolder(folders: Record<string, string>, level: string) {
  const folder = folders[level];
  if (!folder) throw new Error(`No Google Drive folder is configured for ${level}.`);
  return folder;
}

function getDriveClient() {
  if (!cachedDriveClient) cachedDriveClient = createDriveClient();
  return cachedDriveClient;
}

function createDriveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: "v3", auth });
  }

  const email = getServiceAccountEmail();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (email && privateKey) {
    const auth = new google.auth.JWT({
      email,
      key: privateKey.replace(/\\n/g, "\n"),
      scopes: DRIVE_SCOPES,
      subject: process.env.GOOGLE_DRIVE_IMPERSONATED_USER || undefined,
    });
    return google.drive({ version: "v3", auth });
  }

  throw new Error("Google Drive credentials are not configured.");
}

function getServiceAccountEmail() {
  return (
    process.env.GOOGLE_SERVICE_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  );
}

async function findExistingFolderPath(
  drive: drive_v3.Drive,
  rootFolderId: string,
  path: string[],
) {
  let parentId = rootFolderId;
  for (const folderName of path) {
    parentId = await findExistingFolder(drive, parentId, folderName);
  }
  return parentId;
}

async function findExistingFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
) {
  const cacheKey = makeCacheKey(parentId, name);
  const cachedId = folderIdCache.get(cacheKey);
  if (cachedId) return cachedId;

  const response = await drive.files.list({
    q: [
      `'${escapeQueryValue(parentId)}' in parents`,
      `name = '${escapeQueryValue(name)}'`,
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false",
    ].join(" and "),
    spaces: "drive",
    pageSize: 1,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const existingId = response.data.files?.[0]?.id;
  if (!existingId) {
    throw new Error(`The existing Google Drive folder was not found: ${name}.`);
  }

  folderIdCache.set(cacheKey, existingId);
  return existingId;
}

async function findFile(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
) {
  const cacheKey = makeCacheKey(parentId, name);
  const cachedId = fileIdCache.get(cacheKey);
  if (cachedId) return cachedId;

  const response = await drive.files.list({
    q: [
      `'${escapeQueryValue(parentId)}' in parents`,
      `name = '${escapeQueryValue(name)}'`,
      "mimeType = 'image/jpeg'",
      "trashed = false",
    ].join(" and "),
    spaces: "drive",
    pageSize: 1,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  const existingId = response.data.files?.[0]?.id || null;
  if (existingId) fileIdCache.set(cacheKey, existingId);
  return existingId;
}

function makeCacheKey(parentId: string, name: string) {
  return `${parentId}\u0000${name}`;
}

function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
