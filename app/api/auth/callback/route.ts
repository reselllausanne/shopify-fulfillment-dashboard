import { GET as authCallbackGet } from "@/app/auth/callback/route";

export const runtime = "edge";
export const GET = authCallbackGet;

