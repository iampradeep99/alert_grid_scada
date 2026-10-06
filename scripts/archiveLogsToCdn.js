import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import axios from "axios";
import FormData from "form-data";
import { MongoClient } from "mongodb";

const CDN_UPLOAD_URL = "https://pmfby.gov.in/krphapi/FGMS/GCPFileUploadForCDR";
const LOGS_DIR = path.resolve(process.env.LOG_ARCHIVE_DIR || "logs");
const MONGO_COLLECTION = process.env.LOG_ARCHIVE_COLLECTION || "application_log_archives";
const CDN_UPLOAD_PATH = normalizeCdnPath(process.env.LOG_ARCHIVE_CDN_PATH || "krph_logs");
const UPLOADED_BY = process.env.LOG_ARCHIVE_UPLOADED_BY || "KRPH";

function normalizeCdnPath(value) {
  const cleanValue = String(value || "").replace(/^\/+|\/+$/g, "");
  return cleanValue ? `${cleanValue}/` : "";
}

function getCdnUrlFromResponse(responseData) {
  const uploadedFile = responseData?.responseDynamic?.[0]
    || responseData?.file?.[0]
    || responseData?.data?.[0]
    || responseData?.file
    || responseData?.data
    || {};

  return uploadedFile?.gcsUrl
    || uploadedFile?.url
    || uploadedFile?.uploadedURL
    || responseData?.gcsUrl
    || responseData?.url
    || responseData?.fileUrl
    || responseData?.uploadedURL
    || "";
}

function getFilesRecursively(directoryPath) {
  if (!fs.existsSync(directoryPath)) return [];

  const files = [];
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function getRootUpdateLogFiles() {
  return fs.readdirSync(process.cwd())
    .filter((fileName) => fileName.startsWith("update_log_") && fileName.endsWith(".jsonl"))
    .map((fileName) => path.join(process.cwd(), fileName));
}

function removeEmptyDirectories(directoryPath, baseDirectoryPath) {
  if (!fs.existsSync(directoryPath)) return;

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(path.join(directoryPath, entry.name), baseDirectoryPath);
    }
  }

  if (directoryPath !== baseDirectoryPath && fs.readdirSync(directoryPath).length === 0) {
    fs.rmdirSync(directoryPath);
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getYesterdayDateString() {
  const date = new Date();
  date.setDate(date.getDate() - 1);

  return formatDate(date);
}

function getLogDate(filePath, stats) {
  const relativePath = path.relative(process.cwd(), filePath);
  const dateFromPath = relativePath.match(/\d{4}-\d{2}-\d{2}/)?.[0];

  return dateFromPath || formatDate(stats.mtime);
}

function isEligibleForArchive(filePath, stats, targetDate) {
  return getLogDate(filePath, stats) === targetDate;
}

async function uploadLogFileToCdn(filePath, relativePath) {
  const form = new FormData();

  form.append("filePath", CDN_UPLOAD_PATH);
  form.append("uploadedBy", UPLOADED_BY);
  form.append("documents", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
  });

  const response = await axios.post(CDN_UPLOAD_URL, form, {
    headers: { ...form.getHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const cdnUrl = getCdnUrlFromResponse(response.data);
  if (!cdnUrl) {
    throw new Error(`CDN upload response did not include URL for ${relativePath}`);
  }

  return { cdnUrl, cdnResponse: response.data };
}

async function saveArchiveRecord(db, archiveRecord) {
  await db.collection(MONGO_COLLECTION).insertOne({
    ...archiveRecord,
    created_at: new Date(),
  });
}

function deleteRootUpdateLogFiles(targetDate) {
  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  let totalDeletedBytes = 0;

  for (const filePath of getRootUpdateLogFiles()) {
    const stats = fs.statSync(filePath);
    const relativePath = path.relative(process.cwd(), filePath);
    const logDate = getLogDate(filePath, stats);

    if (logDate !== targetDate) {
      skipped++;
      console.log(`Skipped update log file for ${logDate}: ${relativePath}`);
      continue;
    }

    try {
      fs.unlinkSync(filePath);
      deleted++;
      totalDeletedBytes += stats.size;
      console.log(`Deleted update log file: ${relativePath}`);
    } catch (error) {
      failed++;
      console.error(`Failed to delete update log file ${relativePath}: ${error.message}`);
    }
  }

  return {
    deleted,
    skipped,
    failed,
    freedSizeInMB: Number((totalDeletedBytes / 1024 / 1024).toFixed(2)),
  };
}

export async function archiveLogsToCdn(options = {}) {
  if (!process.env.MONGODB) {
    throw new Error("MONGODB env variable is required");
  }

  const mongoClient = new MongoClient(process.env.MONGODB);
  await mongoClient.connect();

  const db = mongoClient.db(process.env.DATABASENAME || "krph_db");
  const logsDirectory = path.resolve(options.logsDir || LOGS_DIR);
  const targetDate = options.targetDate || process.env.LOG_ARCHIVE_DATE || getYesterdayDateString();
  const files = getFilesRecursively(logsDirectory);

  let archivedAndDeleted = 0;
  let skipped = 0;
  let failed = 0;
  let totalDeletedBytes = 0;
  let rootUpdateLogSummary = {
    deleted: 0,
    skipped: 0,
    failed: 0,
    freedSizeInMB: 0,
  };

  try {
    for (const filePath of files) {
      const stats = fs.statSync(filePath);
      const relativePath = path.relative(process.cwd(), filePath);
      const logDate = getLogDate(filePath, stats);

      if (!isEligibleForArchive(filePath, stats, targetDate)) {
        skipped++;
        console.log(`Skipped log file for ${logDate}: ${relativePath}`);
        continue;
      }

      try {
        const uploadResult = await uploadLogFileToCdn(filePath, relativePath);
        const archiveRecord = {
          description: `Archived application log file: ${relativePath}`,
          source_path: filePath,
          relative_path: relativePath,
          file_name: path.basename(filePath),
          file_size: stats.size,
          log_date: logDate,
          last_modified_at: stats.mtime,
          cdn_url: uploadResult.cdnUrl,
          cdn_upload_url: CDN_UPLOAD_URL,
          cdn_upload_path: CDN_UPLOAD_PATH,
          cdn_response: uploadResult.cdnResponse,
          uploaded_by: UPLOADED_BY,
          uploaded_at: new Date(),
        };

        await saveArchiveRecord(db, archiveRecord);
        fs.unlinkSync(filePath);

        archivedAndDeleted++;
        totalDeletedBytes += stats.size;
        console.log(`Archived and deleted: ${relativePath}`);
      } catch (error) {
        failed++;
        console.error(`Failed to archive ${relativePath}: ${error.message}`);
      }
    }

    removeEmptyDirectories(logsDirectory, logsDirectory);
    rootUpdateLogSummary = deleteRootUpdateLogFiles(targetDate);

    return {
      logsDirectory,
      mongoCollection: MONGO_COLLECTION,
      targetDate,
      archivedAndDeleted,
      skipped,
      failed,
      freedSizeInMB: Number((totalDeletedBytes / 1024 / 1024).toFixed(2)),
      rootUpdateLogsDeleted: rootUpdateLogSummary.deleted,
      rootUpdateLogsSkipped: rootUpdateLogSummary.skipped,
      rootUpdateLogsFailed: rootUpdateLogSummary.failed,
      rootUpdateLogsFreedSizeInMB: rootUpdateLogSummary.freedSizeInMB,
    };
  } finally {
    await mongoClient.close();
  }
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  archiveLogsToCdn()
    .then((summary) => {
      console.log("Log archive completed:", summary);
    })
    .catch((error) => {
      console.error("Log archive failed:", error.message);
      process.exitCode = 1;
    });
}
