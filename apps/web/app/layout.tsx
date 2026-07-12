import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getServerProductName } from "@/lib/product-name"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

const productName = getServerProductName()

export const dynamic = "force-dynamic"

export const metadata = {
  title: productName,
  description: "Device inventory and private management access",
  icons: {
    icon: "/favicon.svg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        geistSans.variable,
        fontMono.variable,
        "font-sans"
      )}
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__LOCKHAVEN_CONFIG__=${JSON.stringify({
              productName,
              vpnPublicHostname: process.env.VPN_PUBLIC_HOSTNAME ?? null,
            })};`,
          }}
        />
        <ThemeProvider>
          <TooltipProvider>
            <Providers>{children}</Providers>
            <Toaster position="bottom-center" richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
