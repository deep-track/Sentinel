import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import NextTopLoader from "nextjs-toploader";
import { ConvexClientProvider } from "@/components/convex-client-provider";

const outfit = localFont({
	src: "../fonts/Outfit.ttf",
	variable: "--font-outfit",
	display: "swap",
	fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  icons: {
    icon: '/deeptrack-favicon.ico',
  },
	metadataBase: new URL('https://deeptrack.io'),
  title: 'DeepTrack Sentinel',
  description: 'deeptrack™ is an advanced deepfake detection solution designed for media outlets, financial institutions, and government agencies.',
  openGraph: {
		images: '/deeptrack-logo.png',
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
			<html lang="en">
				<body className={`${outfit.variable} antialiased`}>
					<ConvexClientProvider>
						<NextTopLoader
							color="#54F4FC"
							initialPosition={0.08}
							crawlSpeed={200}
							height={5}
							crawl={true}
							showSpinner={false}
							easing="ease"
							speed={200}
							shadow="0 0 20px 	#54F4FC,0 0 10px 	#54F4FC"
							template='<div class="bar z-99999" role="bar"><div class="peg"></div></div>'
							zIndex={1600}
							showAtBottom={false}
						/>
						<Toaster position="top-center" richColors closeButton />
						{children}
					</ConvexClientProvider>
				</body>
			</html>
		);
}