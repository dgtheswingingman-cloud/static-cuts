"use client";

// Suggestions (moderators): finds from ChatGPT routines and what people send
// with "suggest track", "suggest edit", "wrong link" and the like. Was at the
// bottom of the control room's Work tab.

import ReviewHub from "../../control/ReviewHub";
import { ModPage } from "../../components/Mod";

export default function SuggestionsPage() {
  return (
    <ModPage title="Suggestions" intro="Finds from ChatGPT routines and suggestions from people. Nothing here is live until you approve it.">
      <ReviewHub mode="suggestions" />
    </ModPage>
  );
}
