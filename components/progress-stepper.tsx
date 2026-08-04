'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

type StepStatus = 'completed' | 'current' | 'pending';

interface Step {
  id: string;
  label: string;
  status: StepStatus;
}

interface ProgressStepperProps {
  steps: Step[];
  className?: string;
}

export function ProgressStepper({ steps, className }: ProgressStepperProps) {
  return (
    <div className={cn('w-full px-2 sm:px-4', className)}>
      <nav aria-label="Progress">
        <ol className="flex items-center gap-1 sm:gap-2">
          {steps.map((step, stepIdx) => (
            <li
              key={step.id}
              className={cn(
                'relative flex flex-col items-center flex-1',
                'min-w-0'
              )}
            >
              {/* 연결선 */}
              {stepIdx !== steps.length - 1 && (
                <div
                  className="absolute left-1/2 top-5 h-0.5 w-full hidden sm:block"
                  aria-hidden="true"
                  style={{ marginLeft: '1.25rem' }}
                >
                  <div
                    className={cn(
                      'h-full transition-all duration-500',
                      step.status === 'completed'
                        ? 'bg-primary'
                        : 'bg-muted-foreground/20'
                    )}
                  />
                </div>
              )}

              {/* 단계 표시 */}
              <div className="relative flex flex-col items-center">
                <div
                  className={cn(
                    'relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300',
                    step.status === 'completed' &&
                      'border-primary bg-primary text-primary-foreground',
                    step.status === 'current' &&
                      'border-primary bg-background text-primary shadow-lg shadow-primary/20',
                    step.status === 'pending' &&
                      'border-muted-foreground/30 bg-background text-muted-foreground'
                  )}
                >
                  {step.status === 'completed' ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <span className="text-sm font-semibold">
                      {stepIdx + 1}
                    </span>
                  )}
                </div>

                {/* 단계 레이블 */}
                <span
                  className={cn(
                    'mt-2 text-[10px] sm:text-xs md:text-sm font-medium transition-colors duration-300 text-center leading-tight',
                    step.status === 'current' && 'text-primary',
                    step.status === 'completed' && 'text-foreground',
                    step.status === 'pending' && 'text-muted-foreground',
                    'w-full px-0.5'
                  )}
                  style={{ wordBreak: 'keep-all' }}
                >
                  {step.label}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

