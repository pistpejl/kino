import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Figtree } from "next/font/google";
import "./globals.css";
import { StudioProvider } from "@/context/StudioContext";
import AgeGate from "@/components/AgeGate";
import BottomNav from "@/components/BottomNav";
import RegisterSW from "@/components/RegisterSW";

const instrument = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KINO — Image, video and music videos",
  description:
    "Cinematic AI studio. Image, video and music videos. No credits. Adults 21+.",
  applicationName: "KINO",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "KINO",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
    { media: "(prefers-color-scheme: light)", color: "#0a0a0b" },
  ],
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${instrument.variable} ${figtree.variable}`}>
      <head>
        <meta name="theme-color" content="#0a0a0b" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className="font-sans antialiased bg-kino-bg text-white">
        <StudioProvider>
          <AgeGate />
          <div className="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))]">
            {children}
          </div>
          <BottomNav />
          <RegisterSW />
        </StudioProvider>
      </body>
    </html>
  );
}
