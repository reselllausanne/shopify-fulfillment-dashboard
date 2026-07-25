import type { Metadata } from "next";
import "./globals.css";
import AppNav from "@/app/components/AppNav";
import { ThemeProvider } from "@/app/components/ThemeProvider";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeProvider>
          <AppNav />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

