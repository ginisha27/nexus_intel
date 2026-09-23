// src/lib/imageMetadata.ts
//
// Extracts EXIF/image metadata from the exact image bytes submitted as
// evidence.
//
// The evidence route already decodes imageBase64 into a Buffer. This module
// accepts that Buffer so that:
//   1. SHA-256 hashing
//   2. OCR
//   3. EXIF metadata analysis
//
// all operate on the same submitted image bytes.
//
// Metadata is a signal, NOT proof of fraud:
//   - Missing EXIF can indicate metadata stripping, but many legitimate
//     images (screenshots, PNGs, social-media downloads, etc.) have no EXIF.
//   - Editing software can indicate image manipulation or reuse.
//   - GPS data can corroborate or contradict a claimed location.
//
// This module never throws for normal EXIF parsing failures. It returns a
// structured result instead.

import exifr from "exifr";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB

const EDITING_SOFTWARE_PATTERN =
  /(photoshop|gimp|paint\.net|lightroom|affinity photo|canva)/i;

export interface ImageMetadataResult {
  /**
   * Kept for compatibility with the database/frontend shape.
   * For uploaded evidence this is "uploaded-image".
   */
  imageUrl: string;

  width: number | null;
  height: number | null;

  cameraMake: string | null;
  cameraModel: string | null;

  software: string | null;

  gpsLat: number | null;
  gpsLon: number | null;

  /**
   * String rather than Date because this object is stored in Prisma's
   * JSON field. JSON cannot directly contain a JavaScript Date object.
   */
  capturedAt: string | null;

  metadataStripped: boolean;

  suspicionFlags: string[];

  error?: string;
}

/**
 * Empty/default result used whenever the image cannot be analysed.
 */
function emptyResult(error?: string): ImageMetadataResult {
  return {
    imageUrl: "uploaded-image",
    width: null,
    height: null,
    cameraMake: null,
    cameraModel: null,
    software: null,
    gpsLat: null,
    gpsLon: null,
    capturedAt: null,
    metadataStripped: true,
    suspicionFlags: error
      ? ["metadata_stripped"]
      : [],
    ...(error ? { error } : {}),
  };
}

/**
 * Parse EXIF directly from image bytes.
 *
 * This is deliberately separate from the public function so both
 * URL-based and Buffer-based callers could share the same implementation
 * without duplicating EXIF logic.
 */
async function parseExif(
  imageBuffer: Buffer,
  imageUrl = "uploaded-image"
): Promise<ImageMetadataResult> {
  try {
    const data = await exifr.parse(imageBuffer, {
      pick: [
        "Make",
        "Model",
        "Software",
        "GPSLatitude",
        "GPSLongitude",
        "DateTimeOriginal",
        "ExifImageWidth",
        "ExifImageHeight",
        "ImageWidth",
        "ImageHeight",
      ],
    });

    const hasAnyExif =
      !!data &&
      typeof data === "object" &&
      Object.keys(data).length > 0;

    const flags: string[] = [];

    if (!hasAnyExif) {
      flags.push("metadata_stripped");
    } else {
      if (
        data.Software &&
        EDITING_SOFTWARE_PATTERN.test(String(data.Software))
      ) {
        flags.push("editing_software_detected");
      }

      if (
        typeof data.GPSLatitude === "number" &&
        typeof data.GPSLongitude === "number"
      ) {
        flags.push("gps_present");
      }

      if (!data.Make && !data.Model) {
        flags.push("no_device_info");
      }
    }

    let capturedAt: string | null = null;

    if (data?.DateTimeOriginal) {
      const date = new Date(data.DateTimeOriginal);

      if (!Number.isNaN(date.getTime())) {
        capturedAt = date.toISOString();
      }
    }

    return {
      imageUrl,

      width:
        typeof data?.ExifImageWidth === "number"
          ? data.ExifImageWidth
          : typeof data?.ImageWidth === "number"
            ? data.ImageWidth
            : null,

      height:
        typeof data?.ExifImageHeight === "number"
          ? data.ExifImageHeight
          : typeof data?.ImageHeight === "number"
            ? data.ImageHeight
            : null,

      cameraMake:
        data?.Make != null
          ? String(data.Make)
          : null,

      cameraModel:
        data?.Model != null
          ? String(data.Model)
          : null,

      software:
        data?.Software != null
          ? String(data.Software)
          : null,

      gpsLat:
        typeof data?.GPSLatitude === "number"
          ? data.GPSLatitude
          : null,

      gpsLon:
        typeof data?.GPSLongitude === "number"
          ? data.GPSLongitude
          : null,

      capturedAt,

      metadataStripped: !hasAnyExif,

      suspicionFlags: flags,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : String(err);

    return {
      ...emptyResult(`EXIF parse error: ${message}`),
      imageUrl,
    };
  }
}

/**
 * Main function used by the evidence route.
 *
 * The evidence route passes the already-decoded image Buffer here.
 * This means EXIF analysis is performed on the exact same bytes that
 * were hashed for chain-of-custody and passed to OCR.
 */
export async function extractImageMetadata(
  imageBuffer: Buffer
): Promise<ImageMetadataResult> {
  if (!imageBuffer || imageBuffer.length === 0) {
    return emptyResult("Empty image buffer");
  }

  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    return emptyResult(
      `Image too large (${imageBuffer.length} bytes) — skipped`
    );
  }

  return parseExif(
    imageBuffer,
    "uploaded-image"
  );
}