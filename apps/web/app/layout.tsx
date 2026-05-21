import { Geist_Mono, Roboto } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { getServerProductName } from "@/lib/product-name"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"

const roboto = Roboto({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

const productName = getServerProductName()

export const metadata = {
  title: productName,
  description: "Device inventory and private management access",
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
        fontMono.variable,
        "font-sans",
        roboto.variable
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
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
