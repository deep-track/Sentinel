"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { HiMiniArchiveBoxArrowDown } from "react-icons/hi2";
import { toast } from "sonner";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/modules/shared/errors";

type Props = {
	keyId: string;
};

export default function RevokeApiKey({ keyId }: Props) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [open, setOpen] = useState(false);
	const revoke = useMutation(anyApi.apiKeys.revoke);

	const handleRevoke = async () => {
		setLoading(true);
		try {
			await revoke({ keyId });
			toast.success("API key revoked successfully");
			router.refresh();
		} catch (error) {
			toast.error(getErrorMessage(error, "Failed to revoke API key"));
		} finally {
			setLoading(false);
			setOpen(false);
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					size="icon"
					variant="destructive"
					className="rounded-full"
					aria-label="Revoke API key"
				>
					<HiMiniArchiveBoxArrowDown className="h-4 w-4" />
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to revoke this API key? This action cannot be
						undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							type="button"
							variant="destructive"
							onClick={(event) => {
								// Keep the dialog open until the mutation settles.
								event.preventDefault();
								void handleRevoke();
							}}
							disabled={loading}
						>
							{loading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Revoking...
								</>
							) : (
								"Revoke"
							)}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}