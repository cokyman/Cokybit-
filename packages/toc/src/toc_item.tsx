// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as React from 'react';
import { IHeading } from './utils/headings';

/**
 * Interface describing component properties.
 *
 * @private
 */
interface IProperties {
  /**
   * Heading to render.
   */
  heading: IHeading;
  /**
   * List of headings to use for rendering current position in toc
   */
  toc: IHeading[];

  /**
   * Renders a heading.
   *
   * @param item - heading
   * @param toc - list of headings
   * @returns rendered heading
   */
  itemRenderer: (item: IHeading, toc: IHeading[]) => JSX.Element | null;
}

/**
 * Interface describing component state.
 *
 * @private
 */
interface IState {}

/**
 * React component for a table of contents entry.
 *
 * @private
 */
class TOCItem extends React.Component<IProperties, IState> {
  /**
   * Renders a table of contents entry.
   *
   * @returns rendered entry
   */
  render() {
    const { heading, toc } = this.props;

    // Create an onClick handler for the TOC item
    // that scrolls the anchor into view.
    const onClick = (event: React.SyntheticEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      heading.onClick();
    };

    let content = this.props.itemRenderer(heading, toc);
    return content && <li onClick={onClick}>{content}</li>;
  }
}

/**
 * Exports.
 */
export { TOCItem };
