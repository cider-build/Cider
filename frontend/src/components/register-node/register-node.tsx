import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { createNode } from "../../api";
import { Button } from "../button/button";
import { Modal } from "../modal/modal";
import { TextInput } from "../text-input/text-input";
import styles from "./register-node.module.css";

export function RegisterNode({ text }: { text: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const register = useMutation({
    mutationFn: createNode,
    onSuccess: async () => {
      setName("");
      setUrl("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    register.mutate({ name, url });
  }

  return (
    <>
      <Button styleType={Button.Style.OrangeOffset} onClick={() => setOpen(true)}>{text}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Register node">
        <form className={styles.form} onSubmit={submit}>
          <TextInput styleType={TextInput.Style.BottomBorder} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
          <TextInput styleType={TextInput.Style.BottomBorder} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="URL" />
          <button disabled={register.isPending}>Register</button>
          {register.error && <p className={styles.error}>{register.error.message}</p>}
        </form>
      </Modal>
    </>
  );
}
