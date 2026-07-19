import { Instrument_Sans } from "next/font/google";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export default function ReturnsLayout({ children }: { children: React.ReactNode }) {
  return <div className={instrumentSans.className}>{children}</div>;
}
