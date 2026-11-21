import { createHash } from "node:crypto";
import { PLATFORM_LIMITS } from "./observation-platform.js";

export type ArtifactSensitivity = "public" | "internal" | "sensitive";
export interface ArtifactDescriptor {
  sha256: string;
  byteLength: number;
  mediaType: string;
  locator: string;
  sensitivity: ArtifactSensitivity;
  retentionClass: string;
}
export interface ArtifactPolicy {
  maxBytes: number;
  allowedMediaTypes: string[];
  allowedSensitivities: ArtifactSensitivity[];
  allowedRetentionClasses: string[];
}
export interface ArtifactPutPolicy extends ArtifactPolicy {
  mediaType: string;
  sensitivity: ArtifactSensitivity;
  retentionClass: string;
}
export interface ArtifactStore { put(bytes: Uint8Array, policy: ArtifactPutPolicy): Promise<ArtifactDescriptor> }

export function describeArtifact(bytes: Uint8Array, mediaType: string): Pick<ArtifactDescriptor, "sha256" | "byteLength" | "mediaType"> {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength, mediaType };
}

export function validateArtifactPolicy(
  artifact: Pick<ArtifactDescriptor, "byteLength" | "mediaType" | "sensitivity" | "retentionClass">,
  policy: ArtifactPolicy,
): void {
  if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0 || artifact.byteLength > policy.maxBytes || artifact.byteLength > PLATFORM_LIMITS.maxArtifactBytes) throw new TypeError("artifact byte limit exceeded");
  if (!policy.allowedMediaTypes.includes(artifact.mediaType)) throw new TypeError("artifact media type is not allowed");
  if (!policy.allowedSensitivities.includes(artifact.sensitivity)) throw new TypeError("artifact sensitivity is not allowed");
  if (!policy.allowedRetentionClasses.includes(artifact.retentionClass)) throw new TypeError("artifact retention class is not allowed");
}
