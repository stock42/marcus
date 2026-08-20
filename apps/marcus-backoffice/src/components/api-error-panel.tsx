import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ApiErrorPanel({ code, message }: { code: string; message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle />
      <AlertTitle>No se pudo cargar esta vista</AlertTitle>
      <AlertDescription><span className="font-mono text-xs">{code}</span> · {message}</AlertDescription>
    </Alert>
  );
}
