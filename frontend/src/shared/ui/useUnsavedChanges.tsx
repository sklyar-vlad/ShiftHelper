import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "react-router";
import { Button } from "react-aria-components/Button";
import { Dialog } from "react-aria-components/Dialog";
import { Heading } from "react-aria-components/Heading";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import {
  getGetCurrentUserQueryKey,
  type CurrentUser,
} from "@/shared/api/generated/api";
import "./unsaved-changes.css";

const userKey = getGetCurrentUserQueryKey();

export function useUnsavedChanges(dirty: boolean, onClose?: () => void) {
  const client = useQueryClient();
  const [owner] = useState(() => client.getQueryData<CurrentUser>(userKey)?.id);
  const active = useRef(true);
  const [closing, setClosing] = useState(false);
  const shouldBlock = useCallback(
    () =>
      dirty &&
      active.current &&
      client.getQueryData<CurrentUser>(userKey)?.id === owner,
    [client, dirty, owner],
  );
  const blocker = useBlocker(shouldBlock);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlock()) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, shouldBlock]);

  function stay() {
    blocker.reset?.();
    setClosing(false);
  }

  return {
    allowSavedExit() {
      if (!active.current) return false;
      active.current = false;
      stay();
      return true;
    },
    requestClose() {
      if (shouldBlock()) setClosing(true);
      else onClose?.();
    },
    dialog: (
      <ModalOverlay
        className="unsaved-overlay"
        isOpen={closing || blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open) stay();
        }}
      >
        <Modal className="unsaved-modal">
          <Dialog role="alertdialog">
            <Heading slot="title" level={2}>
              Останутся несохранённые изменения
            </Heading>
            <div className="unsaved-actions">
              <Button className="button" autoFocus onPress={stay}>
                Остаться
              </Button>
              <Button
                className="button button-secondary"
                onPress={() => {
                  active.current = false;
                  setClosing(false);
                  if (blocker.state === "blocked") blocker.proceed();
                  else onClose?.();
                }}
              >
                Уйти без сохранения
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    ),
  };
}
