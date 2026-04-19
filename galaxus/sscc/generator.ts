import "server-only";

import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_GS1_COMPANY_PREFIX,
  GALAXUS_GS1_EXTENSION_DIGIT,
} from "@/galaxus/config";

const COUNTER_ID = "default";

export async function allocateSscc(): Promise<string> {
  const prefix = GALAXUS_GS1_COMPANY_PREFIX.trim();
  if (!prefix || !/^\d+$/.test(prefix)) {
    throw new Error("Missing or invalid GALAXUS_GS1_COMPANY_PREFIX");
  }

  const extensionDigit = normalizeExtensionDigit(GALAXUS_GS1_EXTENSION_DIGIT);
  const serialLength = 17 - 1 - prefix.length;
  if (serialLength <= 0) {
    throw new Error("GS1 company prefix is too long to generate SSCC");
  }

  const counter = await (prisma as any).galaxusSsccCounter.upsert({
    where: { id: COUNTER_ID },
    create: { id: COUNTER_ID, lastSerial: 1 },
    update: { lastSerial: { increment: 1 } },
  });

  const serial = counter.lastSerial;
  const maxSerial = Math.pow(10, serialLength) - 1;
  if (serial > maxSerial) {
    throw new Error("SSCC serial range exhausted");
  }

  const serialRef = serial.toString().padStart(serialLength, "0");
  const base17 = `${extensionDigit}${prefix}${serialRef}`;
  const checkDigit = calculateGs1CheckDigit(base17);
  return `${base17}${checkDigit}`;
}

function normalizeExtensionDigit(value?: string | null): string {
  const digit = (value ?? "0").trim();
  if (!/^\d$/.test(digit)) return "0";
  return digit;
}

function calculateGs1CheckDigit(base17: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = base17.length - 1; i >= 0; i -= 1) {
    sum += Number(base17[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}
