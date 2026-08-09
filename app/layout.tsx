import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pandora Memory",
  description: "Governed operating memory and machine authorization surface.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
