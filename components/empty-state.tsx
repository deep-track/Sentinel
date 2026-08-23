import { cn } from "@/backend/lib/utils";
import React from "react";
import { FcFinePrint } from "react-icons/fc";

type Props = {
	className?: string;
	emptyText?: string;
	iconSize?: string;
};

function EmptyState({ className, emptyText, iconSize }: Props) {
	return (
		<div
			className={cn(
				"h-fit w-full flex items-center justify-center flex-col gap-4",
				className,
			)}
		>
			<FcFinePrint className={cn("size-20", iconSize)} />
			<p className="text-center text-base text-muted-foreground">
				{emptyText || "No data available"}
			</p>
		</div>
	);
}

export default EmptyState;