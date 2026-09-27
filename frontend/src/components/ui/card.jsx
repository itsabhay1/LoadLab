// shadcn/ui Card primitives, adapted for JavaScript (MIT).
import { cn } from '../../utils/cn';

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}
export function CardTitle({ className, ...props }) {
  return <h2 className={cn('text-base font-semibold tracking-tight', className)} {...props} />;
}
export function CardContent({ className, ...props }) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}
