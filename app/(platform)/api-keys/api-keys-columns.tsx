"use client";

import type { APIKey } from "@/backend/lib/types/api-keys";
import { ClientDate } from "@/components/client-date";
import { Badge } from "@/components/ui/badge";
import { TypographyInlineCode } from "@/components/ui/typography";
import type { ColumnDef } from "@tanstack/react-table";
import RevokeApiKey from "./revoke-api-key";

export const apiColumns: ColumnDef<APIKey>[] = [
	{
		accessorKey: "name",
		header: "Name",
	},
	{
		accessorKey: "apiKey",
		header: "Key prefix",
		cell: ({ row }) => (
			<Badge variant="secondary" className="font-mono py-1">
				{`${row.original.apiKey ?? ""}…`}
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
				{row.original.status === "Active" ? "Active" : "Revoked"}
			</Badge>
		),
	},
	{
		accessorKey: "createdAt",
		header: "Created",
		cell: ({ row }) => (
			<TypographyInlineCode className="text-muted-foreground font-sans w-fit">
				<ClientDate value={row.original.createdAt} format="relative" fallback="N/A" />
			</TypographyInlineCode>
		),
	},
	{
		accessorKey: "id",
		header: "Revoke",
		cell: ({ row }) => {
			if (row.original.status === "Suspended") return null;
			return <RevokeApiKey keyId={row.original.id} />;
		},
	},
];
