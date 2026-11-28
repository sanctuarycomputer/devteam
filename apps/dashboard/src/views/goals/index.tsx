// kit-992: the Goals page of the dashboard's / route, ported from index.html (goals's lines: the css-goals-old and
// css-goals regions, the html-goals markup, the goal-block, the goals' cards and states, the fleet switch's page side,
// renderGoals and the goal order). A server module: its markup is exported once into the page, and the script writes
// into it, as index.html's does. The goal-block is the lib's (src/lib/goals-block.ts). Below, every function another
// view calls from it (APPS.md, The view stubs' exports), and closedGoalCardHtml and goalStepData: each a hoisted
// function with the stub's call shape that passes its arguments to goals's module at call time. Goals's modules
// import other views, so call these from a function another view runs later, never at its top level.
import './goals.css';
import * as Block from '../../lib/goals-block';
import * as Cards from './cards';
import * as Fleet from './fleet';
import * as Order from './order';
import GoalsClient from './client';

export default function View() {
  return (
    <>
      <section id="goals" data-page="goals">
        <div id="goals-list"></div>
        <div id="unassigned" className="small dim"></div>
      </section>
      <GoalsClient />
    </>
  );
}

export function activeGoalOrder(..._args: unknown[]): ReturnType<typeof Order.activeGoalOrder> {
  return Order.activeGoalOrder(...(_args as Parameters<typeof Order.activeGoalOrder>));
}

export function ago(..._args: unknown[]): ReturnType<typeof Cards.ago> {
  return Cards.ago(...(_args as Parameters<typeof Cards.ago>));
}

export function closedGoalCardHtml(..._args: unknown[]): ReturnType<typeof Cards.closedGoalCardHtml> {
  return Cards.closedGoalCardHtml(...(_args as Parameters<typeof Cards.closedGoalCardHtml>));
}

export function drawFleet(..._args: unknown[]): ReturnType<typeof Fleet.drawFleet> {
  return Fleet.drawFleet(...(_args as Parameters<typeof Fleet.drawFleet>));
}

export function fleetLeftPlace(..._args: unknown[]): ReturnType<typeof Fleet.fleetLeftPlace> {
  return Fleet.fleetLeftPlace(...(_args as Parameters<typeof Fleet.fleetLeftPlace>));
}

export function fleetMode(..._args: unknown[]): ReturnType<typeof Fleet.fleetMode> {
  return Fleet.fleetMode(...(_args as Parameters<typeof Fleet.fleetMode>));
}

export function fleetStateLine(..._args: unknown[]): ReturnType<typeof Fleet.fleetStateLine> {
  return Fleet.fleetStateLine(...(_args as Parameters<typeof Fleet.fleetStateLine>));
}

export function goalBlock(..._args: unknown[]): ReturnType<typeof Block.goalBlock> {
  return Block.goalBlock(...(_args as Parameters<typeof Block.goalBlock>));
}

export function goalState(..._args: unknown[]): ReturnType<typeof Cards.goalState> {
  return Cards.goalState(...(_args as Parameters<typeof Cards.goalState>));
}

export function goalStepData(..._args: unknown[]): ReturnType<typeof Cards.goalStepData> {
  return Cards.goalStepData(...(_args as Parameters<typeof Cards.goalStepData>));
}

export function goalStepsOf(..._args: unknown[]): ReturnType<typeof Cards.goalStepsOf> {
  return Cards.goalStepsOf(...(_args as Parameters<typeof Cards.goalStepsOf>));
}

export function heartbeatDays(..._args: unknown[]): ReturnType<typeof Block.heartbeatDays> {
  return Block.heartbeatDays(...(_args as Parameters<typeof Block.heartbeatDays>));
}

export function holdConfirming(..._args: unknown[]): ReturnType<typeof Cards.holdConfirming> {
  return Cards.holdConfirming(...(_args as Parameters<typeof Cards.holdConfirming>));
}

export function holdControl(..._args: unknown[]): ReturnType<typeof Cards.holdControl> {
  return Cards.holdControl(...(_args as Parameters<typeof Cards.holdControl>));
}

export function moveGoal(..._args: unknown[]): ReturnType<typeof Order.moveGoal> {
  return Order.moveGoal(...(_args as Parameters<typeof Order.moveGoal>));
}

export function plannerCards(..._args: unknown[]): ReturnType<typeof Cards.plannerCards> {
  return Cards.plannerCards(...(_args as Parameters<typeof Cards.plannerCards>));
}

export function planningFor(..._args: unknown[]): ReturnType<typeof Cards.planningFor> {
  return Cards.planningFor(...(_args as Parameters<typeof Cards.planningFor>));
}

export function renderGoals(..._args: unknown[]): ReturnType<typeof Order.renderGoals> {
  return Order.renderGoals(...(_args as Parameters<typeof Order.renderGoals>));
}
