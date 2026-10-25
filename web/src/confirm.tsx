// Подтверждение действия своим окном, а не window.confirm: стандартное окно браузер может
// молча подавить (например, после «Не показывать больше» или во встроенном браузере), и тогда
// кнопка просто не срабатывает.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './ui';

export interface ConfirmOptions {
  title: string;
  text?: ReactNode;
  ok: string;
  cancel?: string;
  /** Необратимое действие: кнопка красная, а по умолчанию в фокусе — отмена. */
  danger?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(() => Promise.resolve(false));

/** Спросить подтверждение: `if (!(await confirm({ … }))) return;` */
export function useConfirm(): Ask {
  return useContext(ConfirmContext);
}

interface Request extends ConfirmOptions {
  resolve: (answer: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const ask = useCallback<Ask>(
    (options) => new Promise((resolve) => setRequest({ ...options, resolve })),
    [],
  );
  const answer = (value: boolean) => {
    request?.resolve(value);
    setRequest(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && <ConfirmDialog request={request} onAnswer={answer} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  request,
  onAnswer,
}: {
  request: Request;
  onAnswer: (value: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const danger = request.danger;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // Enter подтверждает безопасное действие; у необратимого в фокусе отмена.
    dialog.querySelector<HTMLButtonElement>(danger ? '[data-cancel]' : '[data-ok]')?.focus();
  }, [danger]);
  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      // Esc и щелчок мимо окна — это «отмена».
      onCancel={(e) => {
        e.preventDefault();
        onAnswer(false);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onAnswer(false);
      }}
    >
      <div className="confirm-body">
        <h2 id="confirm-title">{request.title}</h2>
        {request.text && <p className="muted">{request.text}</p>}
        <div className="confirm-actions">
          <Button variant="secondary" data-cancel onClick={() => onAnswer(false)}>
            {request.cancel ?? 'Отмена'}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} data-ok onClick={() => onAnswer(true)}>
            {request.ok}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
