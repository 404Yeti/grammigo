"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SpeakingAnswer } from "@/features/speaking/SpeakingAnswer";
import { TileExercise } from "./TileExercise";
import type { ExerciseViewProps } from "./ExerciseView";

export function SpokenConstruction(props: ExerciseViewProps) {
  const [spoken, setSpoken] = useState(false);
  return <div className="flex flex-col gap-3" data-testid="spoken-construction">
    {spoken ? <>
      <SpeakingAnswer value={props.value} onChange={props.onChange} disabled={props.disabled} error={props.error} inputRef={props.inputRef} onBusyChange={props.onBusyChange} />
      <Button variant="ghost" disabled={props.disabled} onClick={() => setSpoken(false)}>Back to word tiles</Button>
    </> : <>
      <TileExercise question={props.question} value={props.value} disabled={props.disabled} error={props.error} onChange={props.onChange} />
      <Button variant="secondary" disabled={props.disabled} onClick={() => setSpoken(true)}>Speak or type my sentence</Button>
    </>}
  </div>;
}
