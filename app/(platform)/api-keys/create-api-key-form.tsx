"use client";

import { Copy, Eye, EyeOff, Key, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TypographyInlineCode } from "@/components/ui/typography";
import { cn } from "@/backend/lib/utils";
import { getErrorMessage } from "@/modules/shared/errors";

type Environment = "live" | "test";

const ENVIRONMENTS: { value: Environment; label: string; description: string }[] = [
	{
		value: "test",
		label: "Test",
		description: "For development and integration testing.",
	},
	{
		value: "live",
		label: "Live",
		description: "For production traffic. Checks are billed.",
	},
];

type Props = {
	clientId: string;
};

function CreateApiKeyForm({ clientId }: Props) {
	const [open, setOpen] = useState(false);
	const [environment, setEnvironment] = useState<Environment>("test");
	const [submitting, setSubmitting] = useState(false);
	const [showKey, setShowKey] = useState(false);
	const [rawKey, setRawKey] = useState<string | null>(null);
	const [acknowledged, setAcknowledged] = useState(false);
	const router = useRouter();
	const createKey = useMutation(anyApi.apiKeys.createForClient);

	async function handleCreate() {
		setSubmitting(true);
		try {
			const generated: { rawKey: string; prefix: string } = await createKey({
				clientId,
				environment,
			});
			setRawKey(generated.rawKey);
			toast.success("Key created");
			router.refresh();
		} catch (error) {
			console.error("[api-keys] create failed", error);
			toast.error(getErrorMessage(error, "Failed to create key"));
		} finally {
			setSubmitting(false);
		}
	}

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Copied to clipboard");
		} catch {
			toast.error("Couldn't copy — select the key and copy it manually.");
		}
	}

	function reset() {
		setRawKey(null);
		setShowKey(false);
		setAcknowledged(false);
		setEnvironment("test");
	}

	function handleOpenChange(next: boolean) {
		if (next) {
			setOpen(true);
			return;
		}
		// The raw key is only returned once; don't let Esc / outside clicks
		// throw it away before the user confirms they've stored it.
		if (rawKey && !acknowledged) {
			toast.warning("Copy the key and confirm you've stored it before closing.");
			return;
		}
		setOpen(false);
		reset();
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button type="button">
					<Plus className="mr-2 h-4 w-4" />
					Create New Key
				</Button>
			</DialogTrigger>

			<DialogContent>
				<DialogHeader>
					<DialogTitle>{rawKey ? "Your new API key" : "Create New API Key"}</DialogTitle>
					<DialogDescription>
						API keys authenticate your requests to the Sentinel API.
					</DialogDescription>
				</DialogHeader>

				{rawKey ? (
					<div className="space-y-3">
						<div className="flex items-center space-x-2">
							<Key className="h-4 w-4 text-primary" />
							<h3 className="text-sm font-semibold capitalize">{environment} key</h3>
						</div>
						<div className="flex items-center justify-between gap-2 rounded-lg border bg-gradient-to-br from-muted/50 to-muted/95 p-2">
							<TypographyInlineCode className="flex-1 text-sm w-fit break-all">
								{showKey ? rawKey : `${rawKey.slice(0, 12)}*****${rawKey.slice(-4)}`}
							</TypographyInlineCode>
							<div className="ml-auto flex flex-shrink-0 gap-2">
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={() => setShowKey((value) => !value)}
									className="rounded-full"
									aria-label={showKey ? "Hide key" : "Show key"}
								>
									{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={() => void copyToClipboard(rawKey)}
									className="rounded-full"
									aria-label="Copy key"
								>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						</div>
						<p className="text-sm text-destructive">
							This key will only be shown once. Store it securely.
						</p>
						<label className="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								className="mt-0.5 h-4 w-4"
								checked={acknowledged}
								onChange={(event) => setAcknowledged(event.target.checked)}
							/>
							<span>I&apos;ve copied and stored this key.</span>
						</label>
					</div>
				) : (
					<div className="space-y-2">
						<Label>Environment</Label>
						<div className="grid grid-cols-2 gap-3">
							{ENVIRONMENTS.map((option) => (
								<button
									key={option.value}
									type="button"
									onClick={() => setEnvironment(option.value)}
									aria-pressed={environment === option.value}
									className={cn(
										"rounded-lg border-2 p-3 text-left transition-colors",
										environment === option.value
											? "border-primary bg-primary/5"
											: "border-border hover:border-primary/40",
									)}
								>
									<p className="text-sm font-medium">{option.label}</p>
									<p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
								</button>
							))}
						</div>
					</div>
				)}

				<DialogFooter className="gap-2">
					{rawKey ? (
						<Button type="button" disabled={!acknowledged} onClick={() => handleOpenChange(false)}>
							Done
						</Button>
					) : (
						<>
							<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
								Cancel
							</Button>
							<Button type="button" onClick={() => void handleCreate()} disabled={submitting}>
								{submitting ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
									</>
								) : (
									"Create key"
								)}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export default CreateApiKeyForm;
