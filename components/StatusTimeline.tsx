"use client";

export interface TimelineStep {
  key: string;
  label: string;
}

interface StatusTimelineProps {
  steps: TimelineStep[];
  /** Index of the step currently in progress or just completed. */
  currentIndex: number;
  failed?: boolean;
}

export function StatusTimeline({ steps, currentIndex, failed }: StatusTimelineProps) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const isDone = index < currentIndex || (index === currentIndex && index === steps.length - 1 && !failed);
        const isCurrent = index === currentIndex;
        const isFailedStep = failed && isCurrent;

        return (
          <li key={step.key} className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                isFailedStep
                  ? "bg-danger-bg text-danger"
                  : isDone
                    ? "bg-ok-strong text-white"
                    : isCurrent
                      ? "bg-accent text-white"
                      : "bg-panel-3 text-muted"
              }`}
            >
              {isFailedStep ? "!" : isDone ? "✓" : index + 1}
            </span>
            <span className={isCurrent || isDone ? "text-fg" : "text-faint"}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
