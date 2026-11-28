'use client';
// kit-992: goals's client code. Its top level runs once when its chunk loads in the browser and registers goals's 4
// COMPAT globals (closedGoalCardHtml, drawFleet, goalState, renderGoals): each the binding goals's own modules use.
// expose() registers nothing on the server. GoalsClient renders nothing; its one effect runs bootGoals() once, behind
// this module's flag, so a remount (development's double effect) adds no second listener.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { closedGoalCardHtml, goalState } from './cards';
import { drawFleet } from './fleet';
import { bootGoals, renderGoals } from './order';

expose('closedGoalCardHtml', closedGoalCardHtml);
expose('drawFleet', drawFleet);
expose('goalState', goalState);
expose('renderGoals', renderGoals);

let booted = false; // bootGoals() has run

export default function GoalsClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootGoals();
  }, []);
  return null;
}
