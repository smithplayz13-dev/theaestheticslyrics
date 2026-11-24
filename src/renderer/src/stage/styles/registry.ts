import type { StyleId } from '@shared/types'
import { createCodestyle } from './codestyle'
import { createFisheye } from './fisheye'
import { createShip } from './ship'
import type { StageStyle } from './types'
import { createVisual } from './visual'

export function createStyle(id: StyleId): StageStyle {
  switch (id) {
    case 'ship':
      return createShip()
    case 'fisheye':
      return createFisheye(false)
    case 'fisheye-visual':
      return createFisheye(true)
    case 'visual':
      return createVisual()
    case 'codestyle':
      return createCodestyle()
  }
}
