import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Downloads everything the account holds about the signed-in learner. A plain form POST (no script needed): the server answers with a file.
 * It is a POST because it records that an export happened, and so must pass the same-origin check like every state-changing request.
 */
export function ExportButton() {
  return (
    <form action="/api/account/export" method="post">
      <Button type="submit" variant="secondary" data-testid="export-button">
        <Download size={18} aria-hidden /> Download my data
      </Button>
    </form>
  );
}
