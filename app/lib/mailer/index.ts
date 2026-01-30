import type { Mailer } from "@/app/lib/mailer/types";
import { createPostmarkMailer } from "@/app/lib/mailer/postmark";

let cached: Mailer | null = null;

export function getMailer(): Mailer {
  if (cached) return cached;
  cached = createPostmarkMailer();
  return cached;
}

