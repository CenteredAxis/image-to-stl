import type { StatusState } from '../types';

interface Props {
  status: StatusState;
}

export function StatusBar({ status }: Props) {
  return (
    <div className={`status${status.variant ? ' ' + status.variant : ''}`}>
      {status.message}
    </div>
  );
}
