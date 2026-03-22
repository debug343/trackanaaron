import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // handleUpload manages the two-phase client upload protocol:
  // 1. generateClientTokenFromReadWriteToken — client requests a signed upload token
  // 2. onUploadCompleted — called after the client finishes uploading directly to Blob
  const jsonResponse = await handleUpload({
    request: req,
    response: res,
    body: req.body,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      // Verify admin password passed as clientPayload
      if (clientPayload !== process.env.ADMIN_PASSWORD) {
        throw new Error("Unauthorized");
      }
      return {
        allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "video/mov"],
        maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB
      };
    },
    onUploadCompleted: async ({ blob }) => {
      // Nothing to persist server-side; the URL is returned to the client
      console.log("Upload complete:", blob.url);
    },
  });

  return res.status(200).json(jsonResponse);
}
