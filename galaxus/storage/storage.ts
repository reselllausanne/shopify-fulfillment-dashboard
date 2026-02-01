import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "../config";
import { createLocalStorage } from "./localStorage";
import { createSupabaseStorage, isSupabaseUrl } from "./supabaseStorage";
import type { StorageAdapter } from "./types";

export function getStorageAdapter(): StorageAdapter {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseStorage();
  }
  return createLocalStorage();
}

export function getStorageAdapterForUrl(storageUrl: string): StorageAdapter {
  if (isSupabaseUrl(storageUrl)) {
    return createSupabaseStorage();
  }
  return createLocalStorage();
}
