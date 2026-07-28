"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSeparator,
} from "@/components/ui/sidebar";
import { TypographyP, TypographySmall } from "@/components/ui/typography";
import {
	Building2,
	CreditCard,
	Fingerprint,
	Home,
	Key,
	Settings,
	Shield,
	ShieldCheck,
	TrendingUp,
	User2,
	Webhook,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import React from "react";
import { Toaster } from "react-hot-toast";

const getMainItems = () => [
	{ title: "Overview", url: "/dashboard", icon: Home },
	{ title: "Identity (KYC)", url: "/kyc", icon: ShieldCheck },
	{ title: "Business (KYB)", url: "/kyb", icon: Building2 },
	{ title: "KYI", url: "/kyi", icon: TrendingUp },
	{ title: "AML Screening", url: "/aml-check", icon: Shield },
	{ title: "Liveness", url: "/liveness", icon: Fingerprint },
];

const developerItems = [
	{ title: "API Keys", url: "/api-keys", icon: Key },
	{ title: "Webhooks", url: "/webhooks", icon: Webhook },
];

const accountItems = [
	{ title: "Billing & Credits", url: "/billing", icon: CreditCard },
	{ title: "Settings", url: "/settings", icon: Settings },
];

type Props = {
	role: "user" | "admin" | "head";
};

function NavSection({
	label,
	items,
	pathname,
}: {
	label: string;
	items: { title: string; url: string; icon: React.ElementType }[];
	pathname: string;
}) {
	return (
		<SidebarGroup>
			<SidebarGroupLabel className="uppercase text-[10px] tracking-wide text-muted-foreground px-4">
				{label}
			</SidebarGroupLabel>
			<SidebarMenu className="px-4">
				{items.map((item) => (
					<SidebarMenuItem key={item.title}>
						<SidebarMenuButton
							tooltip={item.title}
							asChild
							className="hover:bg-black/90"
						>
							<Link
								href={item.url}
								className={`flex items-center gap-2 px-4 py-2 rounded-xl hover:text-white transition-colors ${
									pathname === item.url ? "bg-black text-white" : ""
								}`}
							>
								<div className="p-2 rounded-xl bg-primary text-primary-foreground">
									<item.icon className="w-5 h-5" />
								</div>
								<span>{item.title}</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}

export function AppSidebar({ role }: Props) {
	const pathname = usePathname();
	const router = useRouter();

	const adminRoutes = ["/members"];
	const headRoles = ["admin", "head"];

	const mainItems = getMainItems();
	if (role === "admin" || role === "head") {
		mainItems.splice(1, 0, { title: "Members", url: "/members", icon: User2 });
	}

	React.useEffect(() => {
		if (
			!headRoles.includes(role) &&
			adminRoutes.some((route) => pathname.startsWith(route))
		) {
			router.push("/dashboard");
		}
	}, [pathname, role, router]);

	return (
		<>
			<Toaster />
			<Sidebar>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>
							<Image
								src="/deeptrack-logo.png"
								alt="DeepTrack logo"
								width={128}
								height={28}
								className="px-2 py-2 mt-2 h-auto"
								priority
							/>
						</SidebarGroupLabel>
					</SidebarGroup>
					<SidebarSeparator />

					<NavSection label="Sentinel" items={mainItems} pathname={pathname} />
					<SidebarSeparator />
					<NavSection label="Developer" items={developerItems} pathname={pathname} />
					<SidebarSeparator />
					<NavSection label="Account" items={accountItems} pathname={pathname} />
				</SidebarContent>

				<SidebarFooter>
					<Card className="m-4 p-4 bg-black text-white border-none">
						<Image
							src="/deeptrack-logo.png"
							alt="DeepTrack logo"
							width={128}
							height={28}
							className="mb-2 h-auto"
							priority
						/>
						<TypographyP className="font-bold">Need help?</TypographyP>
						<TypographySmall>Please check our docs</TypographySmall>
						<Button
							asChild
							variant="secondary"
							className="w-full mt-2 text-black hover:bg-customTeal/90"
						>
							<a
								href="https://docs.deeptrack.io"
								target="_blank"
								rel="noopener noreferrer"
							>
								DOCUMENTATION
							</a>
						</Button>
					</Card>
				</SidebarFooter>
			</Sidebar>
		</>
	);
}