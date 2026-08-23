"use client";

import type { APIKey } from "@/backend/lib/types/api-keys";
import { Badge } from "@/components/ui/badge";
import { TypographyInlineCode } from "@/components/ui/typography";
import { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import RevokeApiKey from "./revoke-api-key";

export const apiColumns: ColumnDef<APIKey>[] = [
	{
		accessorKey: "name",
		header: "Name",
	},
	{
		accessorKey: "apiKey",
		header: "API Key",
		cell: ({ row }) => (
			<Badge variant="secondary" className="font-mono py-1">
				{`${(row.original.apiKey ?? "").slice(0, 4)}****`}
			</Badge>
		),
	},
	{
		accessorKey: "status",
		header: "Status",
		cell: ({ row }) => (
			<Badge
				variant={row.original.status === "Active" ? "success" : "destructive"}
			>
				{row.original.status}
			</Badge>
		),
	},
	{
		accessorKey: "createdAt",
		header: "Created",
		cell: ({ row }) => (
			<TypographyInlineCode className="text-muted-foreground capitalize  font-sans w-fit">
				{row.original.createdAt ? formatDistanceToNow(new Date(row.original.createdAt), {
					addSuffix: true,
				}) : "N/A"}
			</TypographyInlineCode>
		),
	},
	{
		accessorKey: "id",
		header: "Revoke",
		cell: ({ row }) => {
			if (row.original.status === "Suspended") return null;

			return (
				<RevokeApiKey
					keyId={row.original.id}
					userId=""
					companyId=""
				/>
			);
		},
	},
];