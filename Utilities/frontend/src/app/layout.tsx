import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SideNav } from "@/components/side-nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Buxton Utilities",
  description: "Building meter usage & room management",
};

// Inlined into <head> so the stored theme is applied before any CSS paints —
// without this, light-mode users see a brief flash of the dark default.
const themeBootstrapScript = `
(function() {
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light") document.documentElement.classList.add("light");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-neutral-950 text-neutral-100 antialiased`}
      >
        <SideNav />
        <main
          className="px-6 py-8 transition-[margin] duration-200"
          style={{ marginLeft: "var(--sidenav-w)" }}
        >
          <div className="mx-auto max-w-screen-2xl">{children}</div>
        </main>
      </body>
    </html>
  );
}
