import { useState } from "react";

import type { AnswerPayload, QuestionView } from "../api/types";
import ClassificationInteraction from "./ClassificationInteraction";
import NodeConnectionInteraction from "./NodeConnectionInteraction";
import OrderingInteraction from "./OrderingInteraction";

interface QuestionCardProps {
  question: QuestionView;
  disabled?: boolean;
  onSubmit: (answer: AnswerPayload) => void;
}

export default function QuestionCard({
  question,
  disabled = false,
  onSubmit,
}: QuestionCardProps) {
  const [classification, setClassification] = useState<Record<string, string>>(
    {},
  );
  const [ordering, setOrdering] = useState<string[]>(() =>
    question.interaction.type === "ordering"
      ? question.interaction.items.map((item) => item.id)
      : [],
  );
  const [edges, setEdges] = useState<string[][]>([]);

  const canSubmit = (() => {
    switch (question.interaction.type) {
      case "classification":
        return question.interaction.items.every(
          (item) => classification[item.id],
        );
      case "ordering":
        return ordering.length === question.interaction.items.length;
      case "node_connection":
        return edges.length > 0;
    }
  })();

  const handleSubmit = () => {
    switch (question.interaction.type) {
      case "classification":
        onSubmit({ placements: classification });
        return;
      case "ordering":
        onSubmit({ ordered_ids: ordering });
        return;
      case "node_connection":
        onSubmit({ edges });
    }
  };

  return (
    <section className="question" aria-label={question.prompt}>
      {question.interaction.type === "classification" ? (
        <ClassificationInteraction
          items={question.interaction.items}
          categories={question.interaction.categories}
          value={classification}
          disabled={disabled}
          onChange={setClassification}
        />
      ) : null}

      {question.interaction.type === "ordering" ? (
        <OrderingInteraction
          items={question.interaction.items}
          value={ordering}
          disabled={disabled}
          onChange={setOrdering}
        />
      ) : null}

      {question.interaction.type === "node_connection" ? (
        <NodeConnectionInteraction
          nodes={question.interaction.nodes}
          value={edges}
          disabled={disabled}
          onChange={setEdges}
        />
      ) : null}

      <div className="question-actions">
        <button
          type="button"
          className="primary"
          disabled={disabled || !canSubmit}
          onClick={handleSubmit}
        >
          Submit answer
        </button>
      </div>
    </section>
  );
}
