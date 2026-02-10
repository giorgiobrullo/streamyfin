import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

/**
 * Refetches active home queries on mount (cold start) and whenever
 * the app returns to the foreground from background.
 */
export function useRefetchHomeOnForeground() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // On mount (cold start), use cancelRefetch: false so we don't cancel
    // an in-flight initial fetch that React Query already started.
    queryClient.refetchQueries(
      { queryKey: ["home"], type: "active" },
      { cancelRefetch: false },
    );

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // On foreground return, force a fresh refetch
        queryClient.refetchQueries(
          { queryKey: ["home"], type: "active" },
          { cancelRefetch: true },
        );
      }
    });

    return () => subscription.remove();
  }, [queryClient]);
}
