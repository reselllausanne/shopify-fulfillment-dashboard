import type { Metadata } from "next";
import "./globals.css";
import AppNav from "@/app/components/AppNav";

export const metadata: Metadata = {
  title: "Supplier Order Management",
  description: "Order matching and inventory management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppNav />
        {children}
      </body>
    </html>
  );
}

