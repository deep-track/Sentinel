import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { getCurrentUser } from "@/backend/lib/auth";

const f = createUploadthing();

// All verification wizards that upload (KYC/KYB/KYI) live under the
// authenticated (platform) layout, so uploads require a signed-in session.
// UploadThing only accepts power-of-two sizes; 8MB is the closest limit that
// does not exceed the intended 10MB cap for PDFs.
export const ourFileRouter = {
  kycUploader: f({
    image: { maxFileSize: "8MB", maxFileCount: 1 },
    pdf: { maxFileSize: "8MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      const user = await getCurrentUser();
      if (!user) throw new UploadThingError("Unauthorized");
      return { userId: user.id, companyId: user.companyId ?? null };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.info("[uploadthing] kycUploader upload complete", {
        key: file.key,
        userId: metadata.userId,
        companyId: metadata.companyId,
      });
      return { url: file.ufsUrl, uploadedBy: metadata.userId };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
