import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY_SECRET, SUPABASE_URL } from "../config";
import { createLocalStorage } from "./localStorage";
import { createS3Storage, isS3Url } from "./s3Storage";
import { createSupabaseStorage, isSupabaseUrl } from "./supabaseStorage";
import type { StorageAdapter } from "./types";

export function getStorageAdapter(): StorageAdapter {
  if (SUPABASE_URL.includes("/storage/v1/s3") && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_SERVICE_ROLE_KEY_SECRET) {
    return createS3Storage();
  }
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseStorage();
  }
  return createLocalStorage();
}

export function getStorageAdapterForUrl(storageUrl: string): StorageAdapter {
  if (isS3Url(storageUrl)) {
    return createS3Storage();
  }
  if (isSupabaseUrl(storageUrl)) {
    return createSupabaseStorage();
  }
  return createLocalStorage();
}
