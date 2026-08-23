import { cn } from "@/backend/lib/utils";
import clsx from "clsx";
import type React from "react";

function Typography({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return <div className={clsx([`scroll-m-20 ${className}`])}>{children}</div>;
}

export function TypographyH1({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography
			className={clsx([
				"text-4xl font-extrabold tracking-tight lg:text-5xl",
				className,
			])}
		>
			{children}
		</Typography>
	);
}

export function TypographyH2({
	children,
	className,
}: { children: React.ReactNode; className?: string }) {
	return (
		<Typography
			className={cn([
				"pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0",
				className,
			])}
		>
			{children}
		</Typography>
	);
}

export function TypographyH3({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography
			className={clsx(["text-2xl font-semibold tracking-tight", className])}
		>
			{children}
		</Typography>
	);
}

export function TypographyH4({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography
			className={clsx(["text-xl font-semibold tracking-tight", className])}
		>
			{children}
		</Typography>
	);
}

export function TypographyP({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography className={clsx(["leading-7", className])}>
			{children}
		</Typography>
	);
}

export function TypographyBlockquote({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<Typography className={clsx(["mt-6 border-l-2 pl-6 italic"])}>
			{children}
		</Typography>
	);
}

export function TypographyLead({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography className={clsx(["text-xl text-muted-foreground", className])}>
			{children}
		</Typography>
	);
}

export function TypographyInlineCode({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography
			className={clsx([
				"relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
				className,
			])}
		>
			{children}
		</Typography>
	);
}

export function TypographyLarge({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography className={clsx(["text-lg font-semibold", className])}>
			{children}
		</Typography>
	);
}

export function TypographySmall({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Typography
			className={clsx(["text-sm font-medium leading-none", className])}
		>
			{children}
		</Typography>
	);
}

export function TypographyMuted({
	children,
	className,
}: { children: React.ReactNode; className?: string }) {
	return (
		<Typography className={clsx(["text-sm text-muted-foreground"], className)}>
			{children}
		</Typography>
	);
}