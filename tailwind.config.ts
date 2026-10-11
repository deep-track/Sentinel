import type { Config } from "tailwindcss";
import { withUt } from "uploadthing/tw";

export default withUt({
	darkMode: ["class"],
	content: [
		"./pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			fontFamily: {
				outfit: ["Outfit", "sans-serif"],
				grotesk: ["var(--font-space-grotesk)", "Space Grotesk", "sans-serif"],
			},
			backgroundImage: {
				"impact-gradient": "linear-gradient(to right, #000910 0%, rgba(255, 255, 255, 0.58) 19%, #304251 75%, #32383D 100%)",
				"impact-gradient-up": "linear-gradient(to top, #000910 0%, rgba(255, 255, 255, 0.58) 19%, #304251 75%, #32383D 100%)",
				"card-gradient": "linear-gradient(to top right, #1E1E1E 5%, #1a252d 100%)",
			},
			colors: {
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				customTeal: "#54F4FC",
				// Sentinel brand kit (client portal + Sentinel Ops console).
				sentinel: {
					bg: "#0A0B0D",
					surface: "#111318",
					raised: "#16181C",
					line: "#23262B",
					"line-soft": "#1B1E24",
					chip: "#24272E",
					text: "#EDEFF2",
					nav: "#9AA1AB",
					muted: "#8B929C",
					subtle: "#565C64",
					faint: "#3F434B",
					blue: "#0191DA",
					"blue-mid": "#41ACE4",
					"blue-light": "#7EC7EA",
					"blue-bg": "#0D2C40",
					green: "#30A46C",
					"green-text": "#4CC98A",
					"green-bg": "#0F2A1E",
					red: "#E5484D",
					"red-text": "#F0555C",
					"red-bg": "#3A1418",
					amber: "#E8A33D",
					"amber-text": "#F0B34E",
					"amber-bg": "#3A2C10",
					"amber-deep": "#1B1508",
				},
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))",
				},
				popover: {
					DEFAULT: "hsl(var(--popover))",
					foreground: "hsl(var(--popover-foreground))",
				},
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--accent-foreground))",
				},
				destructive: {
					DEFAULT: "hsl(var(--destructive))",
					foreground: "hsl(var(--destructive-foreground))",
				},
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				chart: {
					"1": "hsl(var(--chart-1))",
					"2": "hsl(var(--chart-2))",
					"3": "hsl(var(--chart-3))",
					"4": "hsl(var(--chart-4))",
					"5": "hsl(var(--chart-5))",
				},
				sidebar: {
					DEFAULT: "hsl(var(--sidebar-background))",
					foreground: "hsl(var(--sidebar-foreground))",
					primary: "hsl(var(--sidebar-primary))",
					"primary-foreground": "hsl(var(--sidebar-primary-foreground))",
					accent: "hsl(var(--sidebar-accent))",
					"accent-foreground": "hsl(var(--sidebar-accent-foreground))",
					border: "hsl(var(--sidebar-border))",
					ring: "hsl(var(--sidebar-ring))",
				},
			},
			borderRadius: {
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
			},
		},
	},
	plugins: [require("tailwindcss-animate"), require("tailwind-scrollbar")],
}) satisfies Config;
