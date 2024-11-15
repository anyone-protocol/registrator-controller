import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

@Schema()
export class EventsDiscoveryServiceState {
  @Prop({ type: Boolean, default: false })
  isDiscovering: boolean

  @Prop({ type: Number, required: false })
  lastSafeCompleteBlock?: number
}

export type EventsDiscoveryServiceStateDocument =
  HydratedDocument<EventsDiscoveryServiceState>

export const EventsDiscoveryServiceStateSchema = SchemaFactory.createForClass(
  EventsDiscoveryServiceState
)
