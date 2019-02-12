// @flow

import React, {
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { TreeContext } from './TreeContext';
import { BridgeContext, StoreContext } from './context';
import ButtonIcon from './ButtonIcon';
import HooksTree from './HooksTree';
import InspectedElementTree from './InspectedElementTree';
import { hydrate } from 'src/hydration';
import styles from './SelectedElement.css';

import type { InspectedElement } from '../types';
import type { DehydratedData } from 'src/devtools/types';

export type Props = {||};

export default function SelectedElement(_: Props) {
  const { selectedElementID } = useContext(TreeContext);
  const bridge = useContext(BridgeContext);
  const store = useContext(StoreContext);
  const element =
    selectedElementID !== null ? store.getElementByID(selectedElementID) : null;

  const inspectedElement = useInspectedElement(selectedElementID);

  const handleClick = useCallback(() => {
    if (element !== null && selectedElementID !== null) {
      const rendererID =
        store.getRendererIDForElement(selectedElementID) || null;
      if (rendererID !== null) {
        bridge.send('highlightElementInDOM', {
          displayName: element.displayName,
          id: selectedElementID,
          rendererID,
        });
      }
    }
  }, [bridge, selectedElementID, store]);

  // TODO Make "view DOM" and "view source" buttons work

  if (element === null) {
    return (
      <div className={styles.SelectedElement}>
        <div className={styles.TitleRow} />
      </div>
    );
  }

  const source = inspectedElement ? inspectedElement.source : null;

  return (
    <div className={styles.SelectedElement}>
      <div className={styles.TitleRow}>
        <div className={styles.SelectedComponentName}>
          <div className={styles.Component} title={element.displayName}>
            {element.displayName}
          </div>
        </div>

        <button
          className={styles.IconButton}
          onClick={handleClick}
          title="Highlight this element in the page"
        >
          <ButtonIcon type="view-dom" />
        </button>
        {source !== null && (
          <button
            className={styles.IconButton}
            title="View source for this element"
          >
            <ButtonIcon type="view-source" />
          </button>
        )}
      </div>

      {inspectedElement === null && (
        <div className={styles.Loading}>Loading...</div>
      )}

      {inspectedElement !== null && (
        <InspectedElementView inspectedElement={inspectedElement} />
      )}
    </div>
  );
}

type InspectedElementViewProps = {|
  inspectedElement: InspectedElement,
|};

function InspectedElementView({ inspectedElement }: InspectedElementViewProps) {
  let { context, hooks, owners, props, state } = inspectedElement;
  const { ownerStack } = useContext(TreeContext);

  return (
    <div className={styles.InspectedElement}>
      <InspectedElementTree label="props" data={props} showWhenEmpty />
      <InspectedElementTree label="state" data={state} />
      <HooksTree hooksTree={hooks} />
      <InspectedElementTree label="context" data={context} />

      {ownerStack.length === 0 && owners !== null && owners.length > 0 && (
        <div className={styles.Owners}>
          <div>owner stack</div>
          {owners.map(owner => (
            <OwnerView
              key={owner.id}
              displayName={owner.displayName}
              id={owner.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OwnerView({ displayName, id }: { displayName: string, id: number }) {
  const { selectElementByID } = useContext(TreeContext);

  const handleClick = useCallback(() => selectElementByID(id), [id]);

  return (
    <div
      key={id}
      className={styles.Owner}
      onClick={handleClick}
      title={displayName}
    >
      {displayName}
    </div>
  );
}

function hydrateHelper(dehydratedData: DehydratedData | null): Object | null {
  if (dehydratedData !== null) {
    return hydrate(dehydratedData.data, dehydratedData.cleaned);
  } else {
    return null;
  }
}

function useInspectedElement(id: number | null): InspectedElement | null {
  const idRef = useRef(id);
  const bridge = useContext(BridgeContext);
  const store = useContext(StoreContext);

  const rendererID =
    id === null ? null : store.getRendererIDForElement(id) || null;

  const [inspectedElement, setInspectedElement] = useState(null);

  // Track the most recently-requested element.
  // We'll ignore any backend updates about previous elements.
  idRef.current = id;

  useLayoutEffect(() => {
    // Hide previous/stale insepected element to avoid temporarily showing the wrong values.
    setInspectedElement(null);

    // A null id indicates that there's nothing currently selected in the tree.
    // A null renderer ID indicates that the previously selected element has been unmounted.
    if (id === null || rendererID === null) {
      return () => {};
    }

    let timeoutID = null;

    // Update the $r variable.
    bridge.send('selectElement', { id, rendererID });

    const sendBridgeRequest = () => {
      bridge.send('inspectElement', { id, rendererID });
    };

    const onInspectedElement = (inspectedElement: InspectedElement) => {
      if (inspectedElement && inspectedElement.id !== idRef.current) {
        // TODO Is this sufficient? Will this leak?
        // Ignore bridge updates about previously selected elements.
        return;
      }

      // TODO I think there's a bug here with stale state or a bad listener.
      // "Cannot read property 'inspectElement' of undefined"

      if (inspectedElement !== null) {
        inspectedElement.context = hydrateHelper(inspectedElement.context);
        inspectedElement.hooks = hydrateHelper(inspectedElement.hooks);
        inspectedElement.props = hydrateHelper(inspectedElement.props);
        inspectedElement.state = hydrateHelper(inspectedElement.state);
      }

      setInspectedElement(inspectedElement);

      // Ask for an update in a second...
      timeoutID = setTimeout(sendBridgeRequest, 1000);
    };

    bridge.addListener('inspectedElement', onInspectedElement);

    sendBridgeRequest();

    return () => {
      if (timeoutID !== null) {
        clearTimeout(timeoutID);
      }

      bridge.removeListener('inspectedElement', onInspectedElement);
    };
  }, [id]);

  return inspectedElement;
}
