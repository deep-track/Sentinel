"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Eye, EyeOff, Key, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import type { APIKey } from "@/lib/types/api-keys";
import SubmitButton from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { TypographyInlineCode } from "@/components/ui/typography";

const formSchema = z.object({
	name: z.string().min(1),
});

type Props = {
	userId: string;
	companyId: string;
};

// NOTE: createApiKey previously came from actions/api-keys.ts, which was
// removed as part of the Convex backend migration. There is no public
// Convex mutation yet that creates an API key for a client (only
// generateApiKey exists, scoped differently). This throws an honest
// error instead of pretending to succeed.
/* eslint-disable @typescript-eslint/no-unused-vars */
async function createApiKey(
	userId: string,
	name: string,
	companyId: string
): Promise<APIKey> {
	/* eslint-enable @typescript-eslint/no-unused-vars */
	throw new Error(
		"API key creation isn't wired to the backend yet - no key was created."
	);
}

function CreateApiKeyForm({ userId, companyId }: Props) {
	const [open, setOpen] = useState(false);
	const [showKey, setShowKey] = useState(false);
	const [apiKey, setApiKey] = useState<APIKey | null>(null);
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
	});
	const router = useRouter();

	async function onSubmit(values: z.infer<typeof formSchema>) {
		try {
			const newKey = await createApiKey(userId, values.name, companyId);
			setApiKey(newKey);

			toast.success("Key successfully created");
			router.refresh();
		} catch (error) {
			console.error("Form submission error", error);
			toast.error(
				error instanceof Error ? error.message : "Failed to create key"
			);
		} finally {
			form.reset();
		}
	}

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
		toast.success("Copied to clipboard");
	};

	const handleDialogClose = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setApiKey(null);
			setShowKey(false);
			form.reset();
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleDialogClose}>
			<DialogTrigger asChild>
				<Button onClick={() => setOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Create New Key
				</Button>
			</DialogTrigger>

			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create New API Key</DialogTitle>
					<DialogDescription>
						API keys authenticate your requests to our API services.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>API Key Name</FormLabel>
										<FormControl>
											<Input placeholder="KYC Team" {...field} />
										</FormControl>
										<FormDescription>The name of the API Key</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
							{apiKey && (
								<div className="space-y-2">
									<div className="flex items-center space-x-2">
										<Key className="h-4 w-4 text-primary" />
										<h3 className="text-lg font-semibold">Your New API Key</h3>
									</div>
									<div className="flex items-center justify-between rounded-lg border bg-gradient-to-br from-muted/50 to-muted/95 p-2">
										<TypographyInlineCode className="flex-1 text-sm w-fit">
											{showKey
												? (apiKey.apiKey ?? "")
												: `${(apiKey.apiKey ?? "").slice(0, 8)}*****${(apiKey.apiKey ?? "").slice(-4)}`}
										</TypographyInlineCode>
										<div className="ml-auto flex flex-shrink-0 gap-2">
											<Button
												variant="outline"
												size="icon"
												onClick={() => setShowKey(!showKey)}
												className="rounded-full"
											>
												{showKey ? (
													<EyeOff className="h-4 w-4" />
												) : (
													<Eye className="h-4 w-4" />
												)}
											</Button>
											<Button
												variant="outline"
												size="icon"
												onClick={() => copyToClipboard(apiKey.apiKey ?? "")}
												className="rounded-full"
											>
												<Copy className="h-4 w-4" />
											</Button>
										</div>
									</div>
									<p className="mt-3 text-sm text-destructive">
										⚠️ This key will only be shown once. Store it securely!
									</p>
								</div>
							)}
							<div className="flex items-center justify-end gap-x-2">
								<Button
									variant="outline"
									onClick={() => handleDialogClose(false)}
								>
									{apiKey ? "Close" : "Cancel"}
								</Button>
								<SubmitButton
									isSubmitting={form.formState.isSubmitting}
									text="Create Key"
								/>
							</div>
						</form>
					</Form>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export default CreateApiKeyForm;